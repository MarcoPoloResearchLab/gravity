# syntax=docker/dockerfile:1
FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum ./
ENV GOTOOLCHAIN=auto
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/gravity-api ./cmd/gravity-api

FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=build /out/gravity-api /app/gravity-api
EXPOSE 8080
ENV GRAVITY_DATABASE_PATH=/data/gravity.db
VOLUME ["/data"]
ENTRYPOINT ["/app/gravity-api"]