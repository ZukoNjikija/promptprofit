let currentStep = 0;

const steps = [

  // STEP 1 — BUSINESS PROFILE
  [
    { key: "email", label: "Your Email", type: "text" },
    { key: "business_type", label: "Business Type", type: "text" },
    { key: "stage", label: "Business Stage", type: "text" },
    { key: "revenue", label: "Monthly Revenue", type: "text" }
  ],

  // STEP 2 — CONTENT SYSTEM
  [
    { key: "consistency", label: "How consistent is your content?", type: "select", options: ["never","occasionally","weekly","daily"] },
    { key: "score_content", label: "Rate your content system 0-10", type: "text" }
  ],

  // STEP 3 — SALES SYSTEM
  [
    { key: "followups", label: "How often do you follow up?", type: "select", options: ["never","occasionally","weekly","daily"] },
    { key: "score_sales", label: "Rate your sales system 0-10", type: "text" }
  ],

  // STEP 4 — OPS SYSTEM
  [
    { key: "taskmgmt", label: "How do you manage tasks?", type: "select", options: ["head","notes","some","rare"] },
    { key: "missdeadlines", label: "How often do you miss deadlines?", type: "select", options: ["never","sometimes","freq"] },
    { key: "score_ops", label: "Rate your operations 0-10", type: "text" }
  ],

  // STEP 5 — PAIN POINTS
  [
    { key: "frustrations", label: "What frustrates you the most?", type: "textarea" },
    { key: "primary_offer", label: "Describe your main offer", type: "textarea" },
    { key: "ideal_state", label: "What do you want automated?", type: "textarea" }
  ]
];

let formData = {};

function renderStep() {
  const stepContainer = document.getElementById("step-container");
  stepContainer.innerHTML = "";

  const fields = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;
  document.getElementById("progress-bar").style.width = progress + "%";

  fields.forEach(field => {

    const wrapper = document.createElement("div");
    wrapper.className = "question";

    const label = document.createElement("label");
    label.innerText = field.label;

    let input;

    if (field.type === "select") {
      input = document.createElement("select");
      field.options.forEach(opt => {
        const option = document.createElement("option");
        option.value = opt;
        option.innerText = opt;
        input.appendChild(option);
      });
    } 
    else if (field.type === "textarea") {
      input = document.createElement("textarea");
    } 
    else {
      input = document.createElement("input");
      input.type = "text";
    }

    input.value = formData[field.key] || "";
    input.oninput = (e) => formData[field.key] = e.target.value;

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    stepContainer.appendChild(wrapper);
  });

  document.getElementById("prevBtn").style.display = currentStep === 0 ? "none" : "inline-block";
  document.getElementById("nextBtn").style.display = currentStep === steps.length - 1 ? "none" : "inline-block";
  document.getElementById("submitBtn").style.display = currentStep === steps.length - 1 ? "inline-block" : "none";
}

function nextStep() {
  if (currentStep < steps.length - 1) {
    currentStep++;
    renderStep();
  }
}

function prevStep() {
  if (currentStep > 0) {
    currentStep--;
    renderStep();
  }
}

document.getElementById("auditForm").onsubmit = async function (e) {
  e.preventDefault();

  document.getElementById("loading").classList.remove("hidden");

  const res = await fetch("https://promptprofit-backend.onrender.com/api/audit/submit", {

    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: formData })
  });

  const data = await res.json();

  if (data.redirect) {
    window.location.href = data.redirect;
  }
};
