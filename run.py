import sys
import os
import uvicorn

if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

if __name__ == "__main__":
    host = os.environ.get("LEETTUTOR_HOST", "localhost")
    port = int(os.environ.get("LEETTUTOR_PORT", "8000"))
    uvicorn.run(
        "backend.server:app",
        host=host,
        port=port,
        reload=True,
        reload_dirs=["backend", "frontend"],
    )
