// mouse 3D tilt effect

document.querySelectorAll(".card").forEach(card => {

card.addEventListener("mousemove", e => {

const rect = card.getBoundingClientRect()

const x = e.clientX - rect.left
const y = e.clientY - rect.top

const centerX = rect.width / 2
const centerY = rect.height / 2

const rotateX = (y - centerY) / 10
const rotateY = (centerX - x) / 10

card.style.transform =
`rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.07)`

})

card.addEventListener("mouseleave", () => {

card.style.transform = "rotateX(0) rotateY(0)"

})

})


// floating particles

function createParticle(){

const particle = document.createElement("div")

particle.style.position="fixed"
particle.style.width="4px"
particle.style.height="4px"
particle.style.background="#ff4d00"
particle.style.borderRadius="50%"
particle.style.left=Math.random()*window.innerWidth+"px"
particle.style.top="100%"
particle.style.opacity="0.6"

document.body.appendChild(particle)

let speed = Math.random()*2+1

function animate(){

particle.style.top =
particle.offsetTop - speed + "px"

if(particle.offsetTop < -10){

particle.remove()

}else{

requestAnimationFrame(animate)

}

}

animate()

}

setInterval(createParticle,300)


// smooth card entry animation

window.addEventListener("load",()=>{

document.querySelectorAll(".card").forEach((card,i)=>{

card.style.opacity="0"
card.style.transform="translateY(50px)"

setTimeout(()=>{

card.style.transition="all .6s ease"
card.style.opacity="1"
card.style.transform="translateY(0)"

}, i*200)

})

})