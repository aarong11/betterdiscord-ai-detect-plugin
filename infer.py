# app.py

from fastapi import FastAPI
from pydantic import BaseModel
from transformers import pipeline, AutoModelForSequenceClassification, AutoTokenizer

# Initialize FastAPI app
app = FastAPI()


# Load the model and tokenizer
model_name = "raj-tomar001/LLM-DetectAIve_deberta-base"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSequenceClassification.from_pretrained(model_name)

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
