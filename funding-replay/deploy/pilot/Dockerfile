# Clearline pilot operating desk — private, authenticated, sandbox/manual-evidence only.
# Build from the repository's funding-replay/ folder:
#   docker build -f deploy/pilot/Dockerfile -t clearline-pilot .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PILOT_ENV=pilot PILOT_DB=/data/pilot.db
RUN useradd --create-home --uid 10001 clearline && mkdir -p /data && chown clearline /data
WORKDIR /app
COPY pilot/ /app/pilot/
USER clearline
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health').status==200 else 1)"
# Migrations are forward-only and idempotent; run them on every start, then serve.
CMD ["sh", "-c", "python3 -m pilot.cli migrate && exec python3 -m pilot.cli serve --host 0.0.0.0 --port 8080"]
