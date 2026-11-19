import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const vaultUrl = "https://kv-malfoygr193688560770.vault.azure.net/";

const credential = new DefaultAzureCredential();
const client = new SecretClient(vaultUrl, credential);

export const getSecret = async (secretName) => {
  try {
    const secret = await client.getSecret(secretName);
    return secret.value;
  } catch (error) {
    console.error("KeyVault error:", error.message);
    throw error;
  }
};