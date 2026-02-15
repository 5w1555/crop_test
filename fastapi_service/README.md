FastAPI service for smart-crop

Run locally:

1. Create a virtualenv and install dependencies:

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

2. Start the server:

```
uvicorn fastapi_service.main:app --host 0.0.0.0 --port 8000
```

Docker build:

```
docker build -t smart-crop-fastapi .
docker run -p 8000:8000 -e SMARTCROP_FRONTEND_ORIGINS="http://localhost:3000" smart-crop-fastapi
```

The service exposes `/health` and a POST `/crop` endpoint that accepts a file upload.
