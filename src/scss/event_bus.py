"""Simple async event bus backed by Redis (using redis.asyncio).
Provides publish/subscribe channels and a dead-letter list for problematic payloads.
"""

import json
import asyncio
from typing import Callable, Awaitable, Any
import redis.asyncio as aioredis

class AsyncEventBus:
    def __init__(self, redis_url: str = "redis://localhost:6379/0"):
        self._redis = aioredis.from_url(redis_url)
        self._dlq_key = "scss:dead_letter"

    async def publish(self, channel: str, message: dict):
        payload = json.dumps(message)
        await self._redis.publish(channel, payload)

    async def subscribe(self, channel: str, handler: Callable[[dict], Awaitable[None]]):
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(channel)

        async def reader():
            async for item in pubsub.listen():
                if item is None:
                    continue
                if item.get("type") != "message":
                    continue
                data = item.get("data")
                try:
                    msg = json.loads(data)
                except Exception:
                    await self.push_dead_letter(data)
                    continue
                try:
                    await handler(msg)
                except Exception as e:
                    # Handler failure -> push to DLQ
                    await self.push_dead_letter({"channel": channel, "message": msg, "error": str(e)})

        asyncio.create_task(reader())

    async def push_dead_letter(self, payload: Any):
        await self._redis.rpush(self._dlq_key, json.dumps(payload))

    async def get_dead_letters(self, count: int = 10):
        items = await self._redis.lrange(self._dlq_key, 0, count - 1)
        return [json.loads(i) for i in items]
