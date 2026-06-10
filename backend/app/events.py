"""
SSE (Server-Sent Events) broadcaster for real-time job notifications.
Clients connect via EventSource and receive events when jobs are created or completed.
"""
import asyncio
from typing import Set

class JobEventBroadcaster:
    def __init__(self):
        self._queues: Set[asyncio.Queue] = set()
        self._loop = None

    def subscribe(self) -> asyncio.Queue:
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        q = asyncio.Queue()
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._queues.discard(q)

    def broadcast(self, event_type: str, data: dict):
        """Send event to all connected clients. Thread-safe."""
        import json
        message = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        
        def _send():
            dead = []
            for q in self._queues:
                try:
                    q.put_nowait(message)
                except:
                    dead.append(q)
            for q in dead:
                self._queues.discard(q)

        try:
            loop = asyncio.get_running_loop()
            _send()
        except RuntimeError:
            if self._loop and self._loop.is_running():
                self._loop.call_soon_threadsafe(_send)

    @property
    def client_count(self):
        return len(self._queues)


# Global singleton
job_events = JobEventBroadcaster()
