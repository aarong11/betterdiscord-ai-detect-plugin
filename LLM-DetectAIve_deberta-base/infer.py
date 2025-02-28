from fastapi import FastAPI
from pydantic import BaseModel
from transformers import pipeline, AutoModelForSequenceClassification, AutoTokenizer, AutoConfig

# Initialize FastAPI app
app = FastAPI()

# Define paths
config_dir = "config.json"  # Path to local config.json
model_name = "raj-tomar001/LLM-DetectAIve_deberta-base"  # Load model remotely

# Load configuration from local file
config = AutoConfig.from_pretrained(config_dir)

# Load tokenizer and model from Hugging Face, using local config
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSequenceClassification.from_pretrained(model_name, config=config)

# Create a text classification pipeline
classifier = pipeline("text-classification", model=model, tokenizer=tokenizer)

# Define the input data model
class TextInput(BaseModel):
    text: str

# Define the prediction endpoint
@app.post("/predict")
async def predict(input: TextInput):
    results = classifier(input.text)
    return results
