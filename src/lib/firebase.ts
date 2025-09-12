// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from 'firebase/firestore';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB28Pk2QQAVqDZjyEfyA19i1yFj-4P-GXY",
  authDomain: "fund-guru.firebaseapp.com",
  projectId: "fund-guru",
  storageBucket: "fund-guru.firebasestorage.app",
  messagingSenderId: "587214011679",
  appId: "1:587214011679:web:b99ce0c2760407db14842a",
  measurementId: "G-5V809GLFJL"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Analytics (only in browser environment)
let analytics;
if (typeof window !== 'undefined') {
  analytics = getAnalytics(app);
}

// Initialize Firestore
export const db = getFirestore(app);

export { analytics };
export default app;
