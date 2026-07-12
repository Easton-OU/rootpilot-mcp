# Used by MCP directory services (e.g. Glama) to run automated inspection:
# the server must start and answer introspection (initialize / tools/list),
# which it does even with no hosts configured.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-save typescript@^5.4.0 && npx tsc && npm uninstall --no-save typescript
COPY hosts.example.json README.md LICENSE ./
CMD ["node", "dist/index.js"]
