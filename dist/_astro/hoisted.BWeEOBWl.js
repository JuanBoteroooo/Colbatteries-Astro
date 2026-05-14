import"./hoisted.SYI7de2v.js";const l=new IntersectionObserver(t=>t.forEach(n=>n.isIntersecting&&n.target.classList.add("visible")),{threshold:.12});document.querySelectorAll(".reveal, .reveal-left, .reveal-right").forEach(t=>l.observe(t));const e=document.getElementById("contactForm"),s=document.getElementById("submitBtn"),c=document.getElementById("formSuccess");e?.addEventListener("submit",async t=>{t.preventDefault();const n=e.elements.namedItem("nombre").value.trim(),o=e.elements.namedItem("empresa").value.trim(),m=e.elements.namedItem("email").value.trim(),a=e.elements.namedItem("mensaje").value.trim();s.classList.add("loading"),s.querySelector(".btn-text").textContent="Enviando…";const r=encodeURIComponent(`Hola Colbateries, soy ${n}${o?` de ${o}`:""}.

Mi correo: ${m}

${a}`);window.open(`https://wa.me/50764156382?text=${r}`,"_blank"),s.style.display="none",c.classList.add("visible"),e.reset()});
