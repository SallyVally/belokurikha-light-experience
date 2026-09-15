import { createRoot } from "react-dom/client";
import { HotelExperience } from "@/components/hotel-experience";
import "@/styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");

createRoot(root).render(<HotelExperience />);
