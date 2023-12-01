require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken');
const express = require('express');
const app = express();
const cors = require('cors')
const port = process.env.PORT || 5000;
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
const mg = mailgun.client({
    username: 'api',
    key: process.env.MAIL_GUN_API_KEY,
});


//middleware
app.use(cors())
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fgd8wc9.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const menuCollection = await client.db("bistroDB").collection("menu")
        const reviewsCollection = await client.db("bistroDB").collection("reviews")
        const cartsCollection = await client.db("bistroDB").collection("carts")
        const userCollection = await client.db("bistroDB").collection("users")
        const paymentCollection = await client.db("bistroDB").collection("payments")

        //jwt token
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECURE, { expiresIn: '100001h' });
            res.send({ token })
        })


        //middleware
        //verify token
        const verifyToken = (req, res, next) => {
            // console.log(req.headers);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access token' })
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECURE, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access token' })
                }
                req.decoded = decoded;
                next();
            })

        }

        //use verify Admin after verify token
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access token' })
            }
            next();
        }


        //user collection
        app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
            // console.log(req.headers);
            const result = await userCollection.find().toArray();
            res.send(result)
        })

        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const query = { email: email }
            const user = await userCollection.findOne(query)
            let admin = false;
            if (user) {
                admin = user?.role === 'admin';
            }
            res.send({ admin });
        })

        app.post("/users", async (req, res) => {
            const user = req.body;
            //insert email if user dosnt exist
            //you can do this many ways (1. email unique, 2. upsert, 3. simple checking)
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result)
        })

        app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query)
            res.send(result);
        })

        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    role: 'admin',
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })



        //menus items
        app.get("/menu", async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result)
        })

        app.get("/menu/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: id }
            const result = await menuCollection.findOne(query);
            res.send(result)
        })

        app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body;
            const result = await menuCollection.insertOne(item);
            res.send(result)
        })

        app.patch("/menu/:id", async (req, res) => {
            const item = req.body;
            const id = req.params.id;
            const filter = { _id: id }
            const updatedDoc = {
                $set: {
                    name: item.name,
                    category: item.category,
                    recipe: item.recipe,
                    price: item.price,
                    image: item.image,
                }
            }
            const result = await menuCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })

        app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: id };
            const result = await menuCollection.deleteOne(query);
            res.send(result)
        })


        //reviews items
        app.get("/reviews", async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result)
        })


        //carts items
        app.get("/carts", async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await cartsCollection.find(query).toArray();
            res.send(result)
        })


        app.post("/carts", async (req, res) => {
            const cartItem = req.body;
            const result = await cartsCollection.insertOne(cartItem);
            res.send(result);
        });


        app.delete("/cart/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartsCollection.deleteOne(query);
            res.send(result)
        })


        //payment method
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })


        //payment method
        app.get('/payments/:email', verifyToken, async (req, res) => {
            const query = { email: req.params.email };
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access token' })
            }
            const result = await paymentCollection.find(query).toArray();
            res.send(result)
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);
            //carefully delete each item from the cart
            // console.log('payment info', payment);
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => id)
                }
            }
            const deleteResult = await cartsCollection.deleteMany(query);

            mg.messages
                .create(process.env.MAIL_SENDING_DOMAIN, {
                    from: "Mailgun Sandbox <postmaster@sandbox5b412b6aecdf4d5e868282ad51e5c876.mailgun.org>",
                    to: ["rimonmr444@gmail.com"],
                    subject: "Bistro Boss Order Confirmation ",
                    text: "Testing some Mailgun awesomness!",
                    html: `<div>
                    <h1> Thank you for your order </h1>
                    <h4> Your Transaction Id : <strong> ${payment.transactionId} </strong> </h4>
                    </div>`
                })
                .then(msg => console.log(msg)) // logs response data
                .catch(err => console.log(err)); // logs any error`;


            res.send({ paymentResult, deleteResult });
        })


        //stats or analytics
        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const user = await userCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            //this is not best way
            // const payments = await paymentCollection.find().toArray();
            // const revenue = payments.reduce((total, payment) => total + payment.price, 0)

            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: '$price',
                        }
                    }
                }
            ]).toArray();

            const revenue = result.length > 0 ? result[0].totalRevenue : 0;

            res.send({
                user,
                menuItems,
                orders,
                revenue
            })
        })

        //order status
        /***
         * ----------------------
         *   NON-Efficient way
         * ----------------------
         * 1. load all the payments
         * 2. for every menuItemsId (which is an array), go find the item from menu collection
         * 3. for every item in the menu collection that you found from a payment entry
        */

        //using aggregate pipeline
        app.get('/order-stats', async (req, res) => {
            const result = await paymentCollection.aggregate([
                {
                    $unwind: '$menuItemIds',
                },
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItemIds',
                        foreignField: '_id',
                        as: 'menuItems'
                    }
                },
                {
                    $unwind: '$menuItems',
                },
                {
                    $group: {
                        _id: '$menuItems.category',
                        quantity: { $sum: 1 },
                        revenue: { $sum: '$menuItems.price' },
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: '$_id',
                        quantity: '$quantity',
                        revenue: '$revenue',
                    }
                }
            ]).toArray();

            res.send(result);
        })


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send("boss is sitting")
})

app.listen(port, () => {
    console.log(`bistro boss is sitting on port ${port}`);
})

/**
 * ---------------------
 * NAMING CONVENTION
 * ---------------------
 * app.get('/user)
 * app.get('/user/:id)
 * app.post('/user)
 * app.put('/user/:id)
 * app.patch('/user/:id)
 * app.delete('/user/:id)
 * **/