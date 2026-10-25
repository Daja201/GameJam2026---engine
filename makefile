a:
	rm -rf node_modules package-lock.json
	npm install
	npm run dev
make:
	npm install
	npm run dev
run:
	npm run dev