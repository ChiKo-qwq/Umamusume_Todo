FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
ENV PASSWORD=20120314
EXPOSE 3000

CMD ["node", "server.js"]
