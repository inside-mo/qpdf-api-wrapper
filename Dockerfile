FROM node:18

# Install qpdf
RUN apt-get update && apt-get install -y qpdf

# Create app directory
WORKDIR /app

# Create uploads directory with permissions
RUN mkdir -p /app/uploads && chmod 777 /app/uploads

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port
EXPOSE 1999

# Start the app
CMD ["npm", "start"]
