SHELL := /bin/bash
TIMEOUT_TEST := timeout -k 350s -s SIGKILL 350s
BACKEND_TEST_FLAGS ?=
FRONTEND_TEST_FLAGS ?=

.PHONY: test test-backend test-frontend

test: test-backend test-frontend

test-backend:
	$(TIMEOUT_TEST) bash -lc "cd backend && go test $(BACKEND_TEST_FLAGS) ./..."

test-frontend:
	$(TIMEOUT_TEST) npm --prefix frontend test $(FRONTEND_TEST_FLAGS)
