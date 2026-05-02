import { useState, useRef, useCallback } from 'react'
import { decryptMessage } from '../utils/encryption'

// Chat state + the E2E plumbing. E2E flips on when the user already has
// a key in the URL hash (they followed an invite link); code-join users
// get plain-text chat, which sidesteps key-sync headaches with the lobby.
export function useEncryptedChat({ socketRef, socketIdRef }) {
    const [messages, setMessages] = useState([])
    const [message, setMessage] = useState('')
    const [newMessages, setNewMessages] = useState(0)
    const [typingUsers, setTypingUsers] = useState(new Set())
    const [e2eEnabled, setE2eEnabled] = useState(false)
    const e2eKeyRef = useRef(null)
    const typingTimeout = useRef(null)

    const initE2E = useCallback(async () => {
        try {
            const hash = window.location.hash.slice(1)

            if (hash && hash.length >= 20) {
                // We were sent here from an invite link — the hash IS the key.
                e2eKeyRef.current = hash
                setE2eEnabled(true)
            } else {
                // Joined via code. Mint a key anyway so "Copy Invite Link" still
                // produces a working invite for the next person.
                const { generateRoomKey } = await import('../utils/encryption')
                const key = await generateRoomKey()
                window.history.replaceState(null, '', window.location.pathname + '#' + key)
                e2eKeyRef.current = key
                setE2eEnabled(true)
            }
        } catch (e) {
            console.warn('E2E key init failed:', e.message)
        }
    }, [])

    const addMessage = useCallback(async (data, sender, socketIdSender, timestamp) => {
        let plaintext = data

        if (e2eKeyRef.current && typeof data === 'string' && data.length > 0) {
            // Mixed-mode rooms: some senders encrypt, some don't. Try to decrypt;
            // if the result is the "[encrypted message]" sentinel, fall back to
            // looking at the payload — if it doesn't look like base64 ciphertext
            // it's just plain text and should render as-is.
            try {
                const decrypted = await decryptMessage(data, e2eKeyRef.current)
                if (decrypted !== '[encrypted message]') {
                    plaintext = decrypted
                }
                if (decrypted === '[encrypted message]') {
                    const looksEncrypted = /^[A-Za-z0-9+/]{16,}={0,2}$/.test(data.trim())
                    plaintext = looksEncrypted ? '[encrypted message]' : data
                }
            } catch {
                // Anything thrown during decrypt → keep the original text.
            }
        }

        const isSelf = socketIdSender === socketIdRef.current
        setMessages(prev => [...prev, { sender, data: plaintext, timestamp, isSelf }])
        if (!isSelf) {
            setNewMessages(prev => prev + 1)
        }
    }, [socketIdRef])

    const sendMessage = useCallback(async (msgText, senderName = '') => {
        if (!msgText.trim()) return
        socketRef.current?.emit('chat-message', msgText, senderName)
        socketRef.current?.emit('typing', false)
    }, [socketRef])

    const handleMessageChange = useCallback((value) => {
        setMessage(value)
        socketRef.current?.emit('typing', true)
        clearTimeout(typingTimeout.current)
        typingTimeout.current = setTimeout(() => {
            socketRef.current?.emit('typing', false)
        }, 2000)
    }, [socketRef])

    const updateTypingUser = useCallback((id, isTyping) => {
        setTypingUsers(prev => {
            const next = new Set(prev)
            isTyping ? next.add(id) : next.delete(id)
            return next
        })
    }, [])

    return {
        messages, message, setMessage, newMessages, setNewMessages,
        typingUsers, e2eEnabled, e2eKeyRef,
        initE2E, addMessage, sendMessage, handleMessageChange, updateTypingUser,
    }
}
