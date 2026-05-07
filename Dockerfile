FROM node:24-alpine

WORKDIR /app

COPY package.json server.js ./
COPY public ./public
COPY README.md PRIVACY.md ./

RUN mkdir -p data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV LOCAL_HTTPS=false
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
