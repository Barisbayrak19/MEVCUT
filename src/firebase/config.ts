import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDFEbrVmbXBl-V2vjRAXSYX_uxxQDoQkzU",
  authDomain: "mevcut-33328.firebaseapp.com",
  projectId: "mevcut-33328",
  storageBucket: "mevcut-33328.firebasestorage.app",
  messagingSenderId: "517100041174",
  appId: "1:517100041174:web:f2ba3ebca3243bfbd82a77",
  measurementId: "G-CPQFC8W9JT",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
