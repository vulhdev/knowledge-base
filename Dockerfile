FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

ENV NODE_ENV=production
ENV KB_MCP_PORT=58000
ENV KB_GUI_PORT=57891

EXPOSE 58000
EXPOSE 57891

CMD ["node", "dist/bin/cli.js", "serve"]
