FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=2012
ENV READONLY_PORT=3000
EXPOSE 2012 3000

CMD ["node", "server.js"]
