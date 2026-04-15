from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import json
import os
from datetime import datetime
from functools import wraps

app = Flask(__name__)
app.secret_key = 'supplylink_secret_key_123' 

# Files to store data
ORDERS_FILE = 'orders.json'
USERS_FILE = 'users.json'

# Load Users
def load_users():
    if not os.path.exists(USERS_FILE):
        return {}
    try:
        with open(USERS_FILE, 'r') as f:
            return json.load(f)
    except:
        return {}

USERS = load_users()

# Product Database
PRODUCTS = [
    {"id": 1, "name": "Fresh Milk", "unit": "1 Liter", "price": 1.50, "category": "Dairy", "icon": "🥛"},
    {"id": 2, "name": "Wheat Bread", "unit": "Loaf", "price": 2.20, "category": "Bakery", "icon": "🍞"},
    {"id": 3, "name": "Organic Eggs", "unit": "Dozen", "price": 3.50, "category": "Dairy", "icon": "🥚"},
    {"id": 4, "name": "Ground Coffee", "unit": "500g", "price": 8.00, "category": "Beverages", "icon": "☕"},
    {"id": 5, "name": "Pure Butter", "unit": "250g", "price": 2.50, "category": "Dairy", "icon": "🧈"},
    {"id": 6, "name": "Greek Yogurt", "unit": "500g", "price": 4.00, "category": "Dairy", "icon": "🍦"},
    {"id": 7, "name": "Orange Juice", "unit": "1 Liter", "price": 3.00, "category": "Beverages", "icon": "🍊"},
    {"id": 8, "name": "Digestive Biscuits", "unit": "Pack", "price": 1.80, "category": "Bakery", "icon": "🍪"}
]

def login_required(role=None):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'username' not in session:
                return redirect(url_for('login'))
            if role and USERS.get(session['username'], {}).get('role') != role:
                return "Unauthorized Access", 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def init_orders():
    if not os.path.exists(ORDERS_FILE) or os.stat(ORDERS_FILE).st_size == 0:
        with open(ORDERS_FILE, 'w') as f:
            json.dump([], f)

def get_orders():
    try:
        with open(ORDERS_FILE, 'r') as f:
            content = f.read().strip()
            if not content: return []
            return json.loads(content)
    except:
        return []

def save_order(order):
    try:
        orders = get_orders()
        orders.append(order)
        with open(ORDERS_FILE, 'w') as f:
            json.dump(orders, f, indent=4)
    except Exception as e:
        print(f"Save Error: {e}")

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        u = request.form.get('username')
        p = request.form.get('password')
        user = USERS.get(u)
        if user and user['password'] == p:
            session['username'], session['role'], session['name'] = u, user['role'], user['name']
            return redirect(url_for('admin_dashboard' if user['role'] == 'admin' else 'shop_portal'))
        error = "Invalid Credentials"
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
@login_required(role='owner')
def shop_portal():
    return render_template('shop.html', products=PRODUCTS, user=USERS.get(session['username']))

@app.route('/admin')
@login_required(role='admin')
def admin_dashboard():
    return render_template('admin.html')

@app.route('/api/submit_order', methods=['POST'])
@login_required(role='owner')
def submit_order():
    items = request.json.get('items')
    if not items: return jsonify({"error": "No items"}), 400
    
    order_id = len(get_orders()) + 1
    order = {
        "id": order_id,
        "shop": session['name'],
        "username": session['username'],
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "items": items,
        "status": "Pending",
        "payment_status": "Unpaid" # New field
    }
    save_order(order)
    # Return the payment URL
    return jsonify({"success": True, "redirect": f"/payment/{order_id}"})

@app.route('/payment/<int:order_id>')
@login_required(role='owner')
def payment_page(order_id):
    orders = get_orders()
    order = next((o for o in orders if o['id'] == order_id), None)
    if not order or order['username'] != session['username']:
        return "Order Not Found", 404
        
    # Calculate order total for the payment screen
    total_bill = 0
    for item in order['items']:
        p = next((x for x in PRODUCTS if x['id'] == item['id']), None)
        if p: total_bill += p['price'] * item['count']
        
    return render_template('payment.html', order=order, total=round(total_bill, 2))

@app.route('/api/verify_payment', methods=['POST'])
@login_required(role='owner')
def verify_payment():
    order_id = request.json.get('id')
    orders = get_orders()
    for o in orders:
        if o['id'] == order_id and o['username'] == session['username']:
            o['payment_status'] = "Paid"
            break
    with open(ORDERS_FILE, 'w') as f:
        json.dump(orders, f, indent=4)
    return jsonify({"success": True})

@app.route('/api/orders')
@login_required(role='admin')
def api_get_orders():
    # Show orders that are PAID or have NO payment status (Legacy orders)
    all_orders = get_orders()
    paid_orders = [o for o in all_orders if o.get('payment_status', 'Paid') == "Paid"]
    
    for o in paid_orders:
        total_price = 0
        for item in o['items']:
            product = next((p for p in PRODUCTS if p['id'] == item['id']), None)
            if product:
                item['name'] = product['name']
                item['price'] = product['price']
                item['total'] = round(product['price'] * item['count'], 2)
                total_price += item['total']
        o['total_bill'] = round(total_price, 2)
    return jsonify(paid_orders)

@app.route('/api/update_status', methods=['POST'])
@login_required(role='admin')
def update_status():
    data = request.json
    orders = get_orders()
    for o in orders:
        if o['id'] == data.get('id'):
            o['status'] = data.get('status')
            break
    with open(ORDERS_FILE, 'w') as f:
        json.dump(orders, f, indent=4)
    return jsonify({"success": True})

@app.route('/api/delete_order', methods=['POST'])
@login_required(role='admin')
def delete_order():
    order_id = request.json.get('id')
    orders = get_orders()
    filtered = [o for o in orders if o['id'] != order_id]
    with open(ORDERS_FILE, 'w') as f:
        json.dump(filtered, f, indent=4)
    return jsonify({"success": True})

@app.route('/api/clear_completed', methods=['POST'])
@login_required(role='admin')
def clear_completed():
    orders = get_orders()
    # Keep only PENDING orders
    remaining = [o for o in orders if o.get('status') == 'Pending']
    with open(ORDERS_FILE, 'w') as f:
        json.dump(remaining, f, indent=4)
    return jsonify({"success": True})

@app.route('/api/summary')
@login_required(role='admin')
def get_summary():
    # Only summarize PAID or LEGACY orders
    all_orders = get_orders()
    orders = [o for o in all_orders if o.get('payment_status', 'Paid') == "Paid"]
    
    summary, revenue, pending = {}, 0, 0
    for o in [x for x in orders if x['status'] == 'Pending']:
        pending += 1
        for item in o['items']:
            pid = str(item['id'])
            summary[pid] = summary.get(pid, 0) + item['count']
            p = next((x for x in PRODUCTS if x['id'] == item['id']), None)
            if p: revenue += p['price'] * item['count']
    
    enriched = []
    for pid, count in summary.items():
        p = next((x for x in PRODUCTS if str(x['id']) == pid), None)
        if p: enriched.append({"name": p['name'], "count": count, "unit": p['unit']})
            
    return jsonify({"items": enriched, "total_revenue": round(revenue, 2), "pending_orders": pending})

if __name__ == "__main__":
    init_orders()
    print("\nSupplyLink is LIVE: http://127.0.0.1:5050/login\n")
    app.run(debug=True, port=5050)
