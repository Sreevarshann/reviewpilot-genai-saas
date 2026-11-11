BACKEND := backend
.PHONY: setup db db-down migrate dev-api test test-unit lint typecheck
setup:
	cd $(BACKEND) && npm ci
db:
	docker compose up -d
db-down:
	docker compose down
migrate:
	cd $(BACKEND) && npx prisma migrate deploy
dev-api:
	cd $(BACKEND) && npm run start:dev
test:
	cd $(BACKEND) && npm run test:e2e
test-unit:
	cd $(BACKEND) && npm test
lint:
	cd $(BACKEND) && npm run lint
typecheck:
	cd $(BACKEND) && npm run typecheck
