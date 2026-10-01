import { createAuthClient } from "better-auth/react";
import {
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";

// Cliente de auth para os componentes (mesma origem: /api/auth/*)
export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    twoFactorClient({
      // Desafio de login 2FA (usuário com twoFactorEnabled ainda logando)
      twoFactorPage: "/2fa",
    }),
  ],
});
