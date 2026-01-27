import { useEffect, useRef } from 'preact/hooks';

export function useGameLoop(callback) {
    const callbackRef = useRef(callback);
    const requestRef = useRef(null);
    const previousTimeRef = useRef(null);

    // Always keep latest callback without restarting the loop
    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    useEffect(() => {
        const animate = (time) => {
            if (previousTimeRef.current !== null) {
                const deltaTime = time - previousTimeRef.current;
                // Call latest callback
                callbackRef.current(deltaTime);
            }
            previousTimeRef.current = time;
            requestRef.current = requestAnimationFrame(animate);
        };

        requestRef.current = requestAnimationFrame(animate);

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);
}
