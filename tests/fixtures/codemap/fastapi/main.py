from fastapi import FastAPI
from flask import Flask, Blueprint

app = FastAPI()

@app.get("/items/{item_id}")
def read_item(item_id: int):
    return {"item_id": item_id}

@app.post("/items")
def create_item():
    return {}

flask_app = Flask(__name__)
bp = Blueprint('api', __name__)

@bp.route('/users/<int:id>', methods=['POST'])
def update_user(id):
    pass

@flask_app.route('/info')
def info():
    pass
