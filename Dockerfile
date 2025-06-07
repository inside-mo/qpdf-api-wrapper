FROM node:18

# Install qpdf
RUN apt-get update && apt-get install -y qpdf

# Create app directory and uploads folder
WORKDIR /app
RUN mkdir -p /app/uploads && chmod 777 /app/uploads

# Copy all source files first
COPY . .

# Install dependencies
RUN npm install

# Expose port
EXPOSE 1999

# Start the app
CMD ["npm", "start"]
