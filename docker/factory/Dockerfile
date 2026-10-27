FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY . /opt/aos
ENV PATH="/opt/aos/bin:${PATH}"
RUN useradd -m -d /home/aos aos
USER aos
WORKDIR /work
