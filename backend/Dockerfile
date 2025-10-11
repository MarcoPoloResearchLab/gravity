# syntax=docker/dockerfile:1

FROM golang:1.22.5-bullseye AS builder
WORKDIR /src

ENV CGO_ENABLED=1

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o /out/gravity-api ./cmd/gravity-api

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --home-dir /app gravity \
    && mkdir -p /app /data \
    && chown -R gravity:gravity /app /data

USER gravity

WORKDIR /app

COPY --from=builder /out/gravity-api /app/gravity-api

EXPOSE 8080

ENV GRAVITY_DATABASE_PATH=/data/gravity.db

VOLUME ["/data"]

ENTRYPOINT ["/app/gravity-api"]
