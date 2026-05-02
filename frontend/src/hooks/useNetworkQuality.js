import { useState, useEffect } from 'react'

// Polls candidate-pair RTT every 5s and exposes a coarse good/fair/poor label.
// VideoMeet uses this to drive simulcast layer selection.
export function useNetworkQuality({ connectionsRef, active }) {
    const [networkQuality, setNetworkQuality] = useState('good')

    useEffect(() => {
        if (!active) return

        const interval = setInterval(async () => {
            const connections = connectionsRef.current
            for (const id in connections) {
                try {
                    const stats = await connections[id].getStats()
                    stats.forEach(report => {
                        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                            const rtt = report.currentRoundTripTime
                            if (rtt !== undefined) {
                                if (rtt < 0.15) setNetworkQuality('good')
                                else if (rtt < 0.4) setNetworkQuality('fair')
                                else setNetworkQuality('poor')
                            }
                        }
                    })
                } catch { /* peer disconnected before stats returned */ }
            }
        }, 5000)

        return () => clearInterval(interval)
    }, [active, connectionsRef])

    return { networkQuality }
}
