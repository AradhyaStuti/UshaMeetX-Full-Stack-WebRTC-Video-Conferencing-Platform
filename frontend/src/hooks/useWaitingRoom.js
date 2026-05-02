import { useState, useCallback } from 'react'

// Waiting room state, used by both sides: the host gets the live list of who's
// knocking, and joiners get their admission status. Wire it up by calling
// registerListeners(socket) once the socket has connected.
export function useWaitingRoom({ socketRef }) {
    const [waitingStatus, setWaitingStatus] = useState(null) // null | 'waiting' | 'admitted' | 'rejected'
    const [isHost, setIsHost] = useState(false)
    const [waitingUsers, setWaitingUsers] = useState([])

    const registerListeners = useCallback((socket) => {
        socket.on('waiting-room-status', ({ status }) => setWaitingStatus(status))
        socket.on('host-status', (host) => setIsHost(host))
        socket.on('waiting-room-update', (list) => setWaitingUsers(list))
    }, [])

    const admitUser = useCallback((socketId) => {
        socketRef.current?.emit('admit-user', socketId)
    }, [socketRef])

    const rejectUser = useCallback((socketId) => {
        socketRef.current?.emit('reject-user', socketId)
    }, [socketRef])

    const admitAll = useCallback(() => {
        socketRef.current?.emit('admit-all')
    }, [socketRef])

    return {
        waitingStatus, isHost, waitingUsers,
        admitUser, rejectUser, admitAll, registerListeners,
    }
}
