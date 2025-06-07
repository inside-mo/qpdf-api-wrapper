FROM node:18

# Install qpdf, pdftk and ghostscript for PDF manipulation
RUN apt-get update && apt-get install -y qpdf pdftk ghostscript

WORKDIR /app
RUN mkdir -p /app/uploads && chmod 777 /app/uploads
COPY . .
RUN npm install
EXPOSE 1999
CMD ["npm", "start"]
