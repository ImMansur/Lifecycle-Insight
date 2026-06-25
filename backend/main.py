# """FastAPI application entry point."""
# from __future__ import annotations

# import logging
# import os
# from contextlib import asynccontextmanager

# from dotenv import load_dotenv
# from fastapi import FastAPI
# from fastapi.middleware.cors import CORSMiddleware

# load_dotenv()

# logging.basicConfig(
#     level=logging.INFO,
#     format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
# )

# from routers import ingest, recommendations, actions, export  # noqa: E402


# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     logging.getLogger(__name__).info("WOM Lifecycle Insight backend starting…")
#     yield
#     logging.getLogger(__name__).info("WOM Lifecycle Insight backend shut down.")


# app = FastAPI(
#     title="WOM Lifecycle Insight API",
#     version="1.0.0",
#     description=(
#         "Processes Certificates of Conformance via Azure Document Intelligence "
#         "and Azure OpenAI to generate lifecycle recommendations."
#     ),
#     lifespan=lifespan,
# )

# # CORS — allow all origins (internal / dev tool, no user credentials needed)
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=False,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# app.include_router(recommendations.router)
# app.include_router(ingest.router)
# app.include_router(actions.router)
# app.include_router(export.router)


# @app.get("/")
# async def root():
#     return {
#         "service": "WOM Lifecycle Insight API",
#         "version": "1.0.0",
#         "docs": "/docs",
#     }



"""FastAPI application entry point."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)

from routers import ingest, recommendations, actions, export, users, logs, activity  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger(__name__).info("WOM Lifecycle Insight backend starting…")
    yield
    logging.getLogger(__name__).info("WOM Lifecycle Insight backend shut down.")


app = FastAPI(
    title="WOM Lifecycle Insight API",
    version="1.0.1",
    description=(
        "Processes Certificates of Conformance via Azure Document Intelligence "
        "and Azure OpenAI to generate lifecycle recommendations."
    ),
    lifespan=lifespan,
)

# CORS — allow all origins (internal / dev tool, no user credentials needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include your API routers first
app.include_router(recommendations.router)
app.include_router(ingest.router)
app.include_router(actions.router)
app.include_router(export.router)
app.include_router(users.router)
app.include_router(logs.router)
app.include_router(activity.router)


# Changed from "/" to "/api/info" so it doesn't block your React website
@app.get("/api/info")
async def root():
    return {
        "service": "WOM Lifecycle Insight API",
        "version": "1.0.1",
        "docs": "/docs",
    }


# ---------------------------------------------------------
# REACT FRONTEND SERVING LOGIC
# ---------------------------------------------------------

# Calculate the path to the built React folder (Frontend/dist)
# Since main.py is inside the 'backend' folder, we go up one level ("..")
frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Frontend", "dist"))

# Serve the assets folder (CSS, JS, Images) if it exists
assets_path = os.path.join(frontend_path, "assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

# Catch-all route: Serve static files or React's index.html
@app.get("/{catchall:path}")
async def serve_react_app(catchall: str):
    # Don't intercept requests meant for the API docs
    if catchall in ["docs", "openapi.json"]:
        return {"error": "API route not found"}
        
    # 1. FIRST: Check if the browser is asking for a specific file (like logo.png or favicon.ico)
    requested_file = os.path.join(frontend_path, catchall)
    if os.path.exists(requested_file) and os.path.isfile(requested_file):
        return FileResponse(requested_file)
        
    # 2. FALLBACK: If the file doesn't exist, serve index.html (so React Router can handle the page)
    index_file = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    
    return {
        "error": "React frontend not found.", 
        "path_checked": frontend_path,
        "solution": "Make sure your .gitignore is not blocking the dist folder from being uploaded."
    }