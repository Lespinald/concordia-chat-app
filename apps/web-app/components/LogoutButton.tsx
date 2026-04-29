"use client";

export default function LogoutButton() {
  const logout = async () => {
    await fetch("http://localhost:3000/auth/logout", {
      method: "POST",
      credentials: "include",
    });

    localStorage.removeItem("accessToken");
    window.location.href = "/login";
  };

  return <button onClick={logout}>Logout</button>;
}