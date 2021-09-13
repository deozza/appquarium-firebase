import * as functions from "firebase-functions"
import * as admin from "firebase-admin"
import {auth} from "firebase-admin";
import UserRecord = auth.UserRecord;
import { GraphQLClient } from 'graphql-request'

admin.initializeApp(functions.config().firebase)

const client = new GraphQLClient('https://appquarium.hasura.app/v1/graphql', {
    headers: {
        "content-type": "application/json",
        "x-hasura-admin-secret": functions.config().config.hasura_admin_secret
    }
})

export const createAuthUser = functions.auth.user().onCreate(async (user: UserRecord) => {

    await admin.firestore().collection('user').doc(user.uid).set({
        'roles' : {},
        'displayName': user.displayName,
        'email': user.email,
        'disabled': user.disabled,
        'creationTime': user.metadata.creationTime,
        'lastSignInTime': user.metadata.creationTime
    })

    const mutation = `mutation($uid: String!) {
    insert_users(objects: [{
        uid: $uid,
      }]) {
        affected_rows
      }
    }`;

    try {
        await client.request(mutation, {
            uid: user.uid,
        })

    } catch (e) {
        throw new Error('Unable to create user from Firebase into Hasura')
    }

    const claims = updateRoles(user)
    return admin.auth().setCustomUserClaims(user.uid, claims)
})

export const updateAuthUser = functions.firestore.document('user/{userId}').onUpdate((user) => {
    admin.auth().updateUser(user.after.id, {
        'displayName': user.after.data().displayName,
        'email': user.after.data().email,
        'disabled': user.after.data().disabled,
    })

    const claims = updateRoles(user)

    return admin.auth().setCustomUserClaims(user.after.id, claims)
})

const updateRoles = (user: any) => {
    const defaultClaims = {
        'x-hasura-default-role': 'user',
        'x-hasura-allowed-roles': ['user'],
        'x-hasura-user-id': user.uid,
    }

    const additionalClaims = admin.firestore().collection('user').doc(user.uid).get().then((doc) => {
        if (!doc) { return {} }
        const data = doc.data()
        console.log(`${user.uid} has custom claims`, data)
        return data!.roles
    })

    return {
        'https://hasura.io/jwt/claims': {
            ...defaultClaims,
            ...additionalClaims
        },
    }
}

export const deleteAuthUser = functions.auth.user().onDelete(async (user: UserRecord)=> {
    await admin.firestore().collection('user').doc(user.uid).delete()
    const mutation = `mutation($uid: String!) {
        delete_users_by_pk(uid: $uid)
    }`;

    try {
        await client.request(mutation, {
            uid: user.uid,
        })

    } catch (e) {
        throw new Error('Unable to create user from Firebase into Hasura')
    }
})