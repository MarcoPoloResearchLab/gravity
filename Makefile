SHELL := /bin/bash
TIMEOUT_TEST := timeout -k 350s -s SIGKILL 350s
BACKEND_TEST_FLAGS ?=
FRONTEND_TEST_FLAGS ?=
DOCKER_COMPOSE ?= docker compose
COMPOSE_FILE ?= docker-compose.dev.yml
GO ?= go
STATICCHECK ?= staticcheck
INEFFASSIGN ?= ineffassign
GO_SOURCES := $(shell find backend -type f -name '*.go')

.PHONY: test test-backend test-frontend up fmt lint ci frontend-deps

test: test-backend test-frontend

test-backend:
	bash -lc "cd backend && go test $(BACKEND_TEST_FLAGS) ./..."

test-frontend: frontend-deps
	npm --prefix frontend test $(FRONTEND_TEST_FLAGS)

fmt:
	@if [ -n "$(GO_SOURCES)" ]; then \
		fmt_out=$$(gofmt -l $(GO_SOURCES)); \
		if [ -n "$$fmt_out" ]; then \
			echo "gofmt needed on:"; \
			echo "$$fmt_out"; \
			exit 1; \
		fi; \
	fi

lint:
	@command -v $(STATICCHECK) >/dev/null 2>&1 || { echo 'staticcheck is required (install via `go install honnef.co/go/tools/cmd/staticcheck@latest`)'; exit 1; }
	@command -v $(INEFFASSIGN) >/dev/null 2>&1 || { echo 'ineffassign is required (install via `go install github.com/gordonklaus/ineffassign@latest`)'; exit 1; }
	bash -lc "cd backend && $(GO) vet ./..."
	bash -lc "cd backend && $(STATICCHECK) ./..."
	bash -lc "cd backend && $(INEFFASSIGN) ./..."

ci: fmt lint test

up:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) up --build --remove-orphans

frontend-deps:
	@if [ ! -x frontend/node_modules/.bin/tsc ]; then \
		echo "Installing frontend dependencies..."; \
		npm --prefix frontend install >/dev/null; \
	fi
