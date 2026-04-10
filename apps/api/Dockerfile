FROM node:20-alpine

WORKDIR /workspace

ENV NODE_ENV=development

EXPOSE 3001

CMD ["sh", "-lc", "if [ ! -d node_modules/pg ]; then npm install; fi && npm run dev:api"]
