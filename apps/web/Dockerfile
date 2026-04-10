FROM node:20-alpine

WORKDIR /workspace

ENV NODE_ENV=development

EXPOSE 5173

CMD ["sh", "-lc", "cd apps/web && if [ ! -x node_modules/.bin/vite ]; then npm install; fi && npm run dev -- --host 0.0.0.0"]
