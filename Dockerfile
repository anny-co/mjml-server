FROM node:22-alpine

WORKDIR /app

COPY ./package.json ./yarn.lock /app/

RUN yarn install

EXPOSE 80

COPY . /app/

ENTRYPOINT ["node", "./index.js"]
