FROM python:3.9-slim

WORKDIR /app

# Install git to clone the repository
RUN apt-get update && apt-get install -y git && apt-get clean

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Clone the original OMRChecker repo
RUN git clone https://github.com/Udayraj123/OMRChecker.git

# Create a patched version of the problematic file
RUN sed -i 's/from src.logger import logger/from .logger import logger/g' /app/OMRChecker/src/__init__.py

# Copy your application files
COPY . .

# Add both the current directory and the OMRChecker directory to PYTHONPATH
ENV PYTHONPATH="${PYTHONPATH}:/app:/app/OMRChecker"

# Expose port 8000 to match Coolify's default
EXPOSE 8000

CMD ["python", "app.py"]
