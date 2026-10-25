FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-package-lock
COPY . .
EXPOSE 3000
# Dev server: reads NEXT_PUBLIC_* at runtime, so the API mode can change without a rebuild.
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
