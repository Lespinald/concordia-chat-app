export async function apiFetch(url: string, options: any = {}) {
  let res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
    },
  });

  if (res.status === 401) {
    const refresh = await fetch("http://localhost:3000/auth/refresh", {
      method: "POST",
      credentials: "include",
    });

    if (refresh.ok) {
      const data = await refresh.json();
      localStorage.setItem("accessToken", data.accessToken);

      res = await fetch(url, {
        ...options,
        credentials: "include",
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${data.accessToken}`,
        },
      });
    } else {
      localStorage.removeItem("accessToken");
      window.location.href = "/login";
    }
  }

  return res;
}