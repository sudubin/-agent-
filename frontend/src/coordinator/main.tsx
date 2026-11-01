import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Product } from "./Product";
import "./style.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, networkMode: "always", refetchOnWindowFocus: true }, mutations: { networkMode: "always" } } });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Product /></QueryClientProvider>);
