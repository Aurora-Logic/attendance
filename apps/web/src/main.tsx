import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter } from "react-router"

import App from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { AppConfigProvider } from "@/lib/app-config"
import { ProcurementProvider } from "@/lib/procurement"
import { SalesProvider } from "@/lib/sales"
import { ExpensesProvider } from "@/lib/expenses"
import { SessionProvider } from "@/lib/session"
import "@/index.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppConfigProvider>
            <SessionProvider>
              <ProcurementProvider>
                <SalesProvider>
                  <ExpensesProvider>
                    <App />
                  </ExpensesProvider>
                </SalesProvider>
              </ProcurementProvider>
            </SessionProvider>
          </AppConfigProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
