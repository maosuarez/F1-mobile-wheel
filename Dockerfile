FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt
COPY server/ server/
COPY --from=build /app/dist dist/
RUN chmod -R a+rX server dist && useradd --system --no-create-home app
USER app
ENV DIST_DIR=/app/dist
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/info', timeout=2)"]
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
