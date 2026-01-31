import sys
import uvicorn

if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

if __name__ == "__main__":
    uvicorn.run("backend.server:app", host="localhost", port=8000, reload=True)
