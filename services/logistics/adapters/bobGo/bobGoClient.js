// src/services/logistics/adapters/bobGo/bobGoClient.js
import axios from "axios";

class BobGoClient {
  constructor() {
    this.apiUrl = process.env.BOBGO_API_URL || "https://api.bobgo.co.za";
    this.apiKey = process.env.BOBGO_API_KEY;
    this.webhookSecret = process.env.BOBGO_WEBHOOK_SECRET;
    this.environment = process.env.BOBGO_ENVIRONMENT || "staging";
  }

  getHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
      headers["X-API-Key"] = this.apiKey;
    }
    return headers;
  }

  async get(path, config = {}) {
    try {
      const response = await axios.get(`${this.apiUrl}${path}`, {
        headers: this.getHeaders(),
        timeout: 10000,
        ...config,
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async post(path, data = {}, config = {}) {
    try {
      const response = await axios.post(`${this.apiUrl}${path}`, data, {
        headers: this.getHeaders(),
        timeout: 15000,
        ...config,
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  handleError(error) {
    const err = new Error(
      error.response?.data?.message || error.message || "Bob Go API error"
    );
    err.status = error.response?.status;
    err.data = error.response?.data;
    err.provider = "bobgo";
    return err;
  }
}

export default BobGoClient;
