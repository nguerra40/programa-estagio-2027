FROM node:18-alpine

# better-sqlite3 precisa de build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# Cria pasta de dados para SQLite
RUN mkdir -p /app/data

EXPOSE 8000

CMD ["node", "src/server.js"]
