FROM node:18
RUN apt-get update && apt-get install -y qpdf pdftk poppler-utils
WORKDIR /app
RUN mkdir -p /app/uploads && chmod 777 /app/uploads
COPY . .
RUN npm install
EXPOSE 1999
CMD ["npm", "start"]
