import"./Navbar.astro_astro_type_script_index_0_lang.BJJOBZwS.js";const r=new IntersectionObserver(e=>e.forEach(n=>n.isIntersecting&&n.target.classList.add("visible")),{threshold:.12});document.querySelectorAll(".reveal, .reveal-left, .reveal-right").forEach(e=>r.observe(e));const t=document.getElementById("contactForm");t?.addEventListener("submit",e=>{e.preventDefault();const n=t.elements.namedItem("nombre").value,o=t.elements.namedItem("empresa").value,s=t.elements.namedItem("email").value,a=t.elements.namedItem("mensaje").value,m=encodeURIComponent(`Hola Colbateries, soy ${n}${o?` de ${o}`:""}.

Mi correo: ${s}

${a}`);window.open(`https://wa.me/50764156382?text=${m}`,"_blank")});
